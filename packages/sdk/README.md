# @vitest-agent/sdk

[![npm](https://img.shields.io/npm/v/@vitest-agent/sdk?label=npm&color=cb3837)](https://www.npmjs.com/package/@vitest-agent/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

> **Part of the [vitest-agent](https://vitest-agent.dev) ecosystem.** Most users want **[@vitest-agent/plugin](https://www.npmjs.com/package/@vitest-agent/plugin)**, which pulls this package in automatically. Install `@vitest-agent/sdk` directly only if you build tooling on the shared schemas or contract types.

The platform-free core of the vitest-agent ecosystem. Carries the Effect Schemas, the public reporter and dispatcher contract types, the tagged errors, the pure formatters and utilities, the pure sidecar `dispatch` entry, and the published JSON Schemas. It has no workspace dependencies and never imports `node:*`, so it runs anywhere Effect does.

Everything that touches a filesystem, a process, or SQLite — the `DataStore` / `DataReader` services and their live layers, migrations, `ensureMigrated`, `PlatformLive`, `resolveDataPath`, and the test-layer helpers — lives in **[@vitest-agent/engine](https://www.npmjs.com/package/@vitest-agent/engine)**.

## Features

- **Effect Schemas** — all domain types (`AgentReport`, `RunEvent`, `RenderState`, `CoverageTargets`, `TurnPayload`, identity types) defined with Effect Schema; runtime validation and TypeScript types from one source
- **Reporter and dispatcher contracts** — `VitestAgentReporterFactory`, `ReporterKit`, `ResolvedReporterConfig`, `DispatchInputs` and the types consumed by every other package
- **Tagged errors** — `Data.TaggedError` families for data-store, discovery, path-resolution, project-identity, run-context, TDD and agent failures
- **Pure formatters and utilities** — terminal, markdown, GFM, JSON and CI-annotation formatters, plus `classifyTestPath`, `buildAgentReport`, `validatePhaseTransition` and the posix path helpers
- **Sidecar dispatch core** — `dispatch`, `injectEnv` and `exitCodeForTag` on the `@vitest-agent/sdk/dispatch` sub-path for a minimal SEA bundle
- **JSON Schemas** — generated schemas on the `@vitest-agent/sdk/schemas/*.json` sub-path (for example the run-report file schema)

## Install

```bash
npm install @vitest-agent/sdk
# or
pnpm add @vitest-agent/sdk
```

## Quick start

```ts
import { Schema } from "effect";
import { AgentReport, CoverageLevel } from "@vitest-agent/sdk";

// Decode a persisted run report with the shared schema
const report = Schema.decodeUnknownSync(AgentReport)(JSON.parse(raw));

// Reuse the coverage presets that AgentPlugin.COVERAGE_LEVELS is built on
const targets = CoverageLevel.standard.withPerFile();
```

Need the data layer, services, or an in-memory test layer? Reach for the engine:

```ts
import { DataReader } from "@vitest-agent/engine";
import { singlePassingRun } from "@vitest-agent/engine/testing";
```

## Documentation

Package reference at [vitest-agent.dev/sdk](https://vitest-agent.dev/sdk).

## License

[MIT](LICENSE)
