# vitest-agent-reporter

[![npm](https://img.shields.io/npm/v/vitest-agent-reporter?label=npm&color=cb3837)](https://www.npmjs.com/package/vitest-agent-reporter)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)

The escape-hatch SDK for building a custom reporter on top of [vitest-agent-plugin](https://github.com/spencerbeggs/vitest-agent). One package, one import: the reporter contract types from `vitest-agent-sdk` plus the dispatcher helpers from `vitest-agent-ui`. If you only want the default behavior, you do not need this package — install `vitest-agent-plugin` and the built-in reporter wires automatically.

## Why this package exists

The plugin ships a preassembled default reporter that handles the common cases: a markdown-flavored end-of-run frame for agent runs, a live React Ink view for human runs, footers that point at the right MCP tool for the dominant outcome, GitHub Step Summary output under Actions. Most users never need to think about reporter wiring.

If the default does not produce the output you want, you write a `VitestAgentReporterFactory` and pass it as the plugin's `reporter` option. This package gives you everything that factory needs in one import:

```typescript
import type {
  ReporterKit,
  ReporterRenderInput,
  RenderedOutput,
  ResolvedReporterConfig,
  VitestAgentReporter,
  VitestAgentReporterFactory,
} from "vitest-agent-reporter";
import {
  buildDispatchInputs,
  resolveCellOptions,
} from "vitest-agent-reporter";
```

## Install

```bash
npm install --save-dev vitest-agent-reporter
# or
pnpm add -D vitest-agent-reporter
```

`vitest-agent-reporter` is a peer dependency of `vitest-agent-plugin`, so a plugin install pulls it in on modern pnpm and npm. Install it explicitly only when authoring a custom reporter or when your package manager skips peers.

## Building a custom reporter

A reporter factory takes the resolved `ReporterKit` and returns an object whose `render(input)` is called once at end-of-run with the per-project `AgentReport[]`:

```typescript
import type {
  ReporterKit,
  ReporterRenderInput,
  RenderedOutput,
  VitestAgentReporter,
  VitestAgentReporterFactory,
} from "vitest-agent-reporter";
import {
  buildDispatchInputs,
  resolveCellOptions,
} from "vitest-agent-reporter";

const myReporter: VitestAgentReporterFactory = (kit: ReporterKit): VitestAgentReporter => ({
  async render(input: ReporterRenderInput): Promise<RenderedOutput[]> {
    const dispatchInputs = buildDispatchInputs(input.reports, kit);
    const cellOptions = resolveCellOptions(kit, dispatchInputs);
    // dispatchInputs carries shape, outcome, project aggregates, trend,
    // and below-target listings — all the pre-computed inputs the
    // built-in cells consume.
    return [
      {
        target: "stdout",
        content: `Custom report for ${dispatchInputs.projects.length} project(s)\n`,
      },
    ];
  },
});
```

Pass the factory to the plugin:

```typescript
import { AgentPlugin } from "vitest-agent-plugin";

AgentPlugin({
  console: { agent: "agent" },
  reporter: myReporter,
});
```

## What the helpers do

| Helper | Source | Description |
| --- | --- | --- |
| `buildDispatchInputs(reports, kit)` | `vitest-agent-ui` | Assembles a fully-populated `DispatchInputs` from per-project `AgentReport[]`. Pre-computes shape, outcome, project aggregates, trend direction, and below-target listings |
| `resolveCellOptions(kit, dispatchInputs)` | `vitest-agent-ui` | Resolves the per-cell option object: color flag, OSC-8 enablement, MCP hint flag, etc. |

The contract types come from `vitest-agent-sdk`:

| Type | Description |
| --- | --- |
| `ResolvedReporterConfig` | The resolved facts the plugin computes per run: `consoleMode`, `coverageMode`, `format`, `detail`, environment, executor |
| `ReporterKit` | The bundle the plugin hands to a factory: `config`, `dbPath`, `noColor`, `osc8`, `env` |
| `ReporterRenderInput` | The input to `render()`: per-project `reports`, `unhandledErrors`, `reason` |
| `RenderedOutput` | One emit target: `{ target: "stdout" \| "github-summary" \| "file", content: string }` |
| `VitestAgentReporter` | The object returned by a factory; has one method `render(input)` |
| `VitestAgentReporterFactory` | `(kit: ReporterKit) => VitestAgentReporter` |

## Documentation

See the [main README](https://github.com/spencerbeggs/vitest-agent#readme) and the [configuration reference](https://github.com/spencerbeggs/vitest-agent/blob/main/docs/configuration.md) for plugin wiring. The [vitest-agent-ui README](https://github.com/spencerbeggs/vitest-agent/blob/main/packages/ui/README.md) covers the dispatcher matrix and the preassembled default reporter that the helpers re-export from here.

## License

[MIT](./LICENSE)
