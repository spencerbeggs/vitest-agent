# @vitest-agent/reporter

[![npm](https://img.shields.io/npm/v/@vitest-agent/reporter?label=npm&color=cb3837)](https://www.npmjs.com/package/@vitest-agent/reporter)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

> **Part of the [vitest-agent](https://vitest-agent.dev) ecosystem.** Most users want **[@vitest-agent/plugin](https://www.npmjs.com/package/@vitest-agent/plugin)**, which pulls this package in automatically. Install `@vitest-agent/reporter` directly only if you are writing a custom reporter.

The default reporter package and the reference for custom-reporter authors. Ships `DefaultVitestAgentReporter`, owns the live React Ink mount lifecycle, and re-exports the reporter contract types and dispatch helpers — everything a custom factory needs in one import.

## Features

- **`DefaultVitestAgentReporter`** — the production default `VitestAgentReporterFactory` the plugin wires automatically; classifies runs into one of 12 shape × outcome cells, owns the Ink live-mount lifecycle, and emits a GitHub Actions Step Summary in CI
- **Dispatch helpers** — `buildDispatchInputs`, `resolveCellOptions`, `renderAgentStringForReport`, `renderHumanStringForReport`
- **Contract re-exports** — `VitestAgentReporterFactory`, `ReporterKit`, `ReporterRenderInput`, `RenderedOutput`, `VitestAgentReporter`, `ResolvedReporterConfig` all re-exported from `@vitest-agent/sdk` so you only need one import
- **Worked example** — `DefaultVitestAgentReporter` source in this package is the canonical reference for the `VitestAgentReporterFactory` contract

## Install

```bash
npm install --save-dev @vitest-agent/reporter
# or
pnpm add -D @vitest-agent/reporter
```

`@vitest-agent/reporter` arrives automatically as a dependency of `@vitest-agent/plugin`. Install it directly only when authoring a custom reporter.

## Quick start

```ts
import type {
  ReporterKit,
  ReporterRenderInput,
  RenderedOutput,
  VitestAgentReporter,
  VitestAgentReporterFactory,
} from "@vitest-agent/reporter";

const myReporter: VitestAgentReporterFactory = (kit: ReporterKit): VitestAgentReporter => ({
  render(input: ReporterRenderInput): ReadonlyArray<RenderedOutput> {
    const passed = input.reports.reduce((n, r) => n + r.summary.passed, 0);
    return [{ target: "stdout", content: `${passed} passed\n` }];
  },
});
```

Pass the factory to the plugin:

```ts
import { AgentPlugin } from "@vitest-agent/plugin";

AgentPlugin({ reporter: myReporter });
```

## Documentation

Custom-reporter guide at [vitest-agent.dev/reporter](https://vitest-agent.dev/reporter).

## License

[MIT](LICENSE)
